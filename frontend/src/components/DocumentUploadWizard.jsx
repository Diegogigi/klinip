import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  uploadDocument,
  getDocumentAnalysis,
  updateDocument,
  activateDocumentItems,
} from "../services/httpApi";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";

/**
 * Asistente de subida de documentos (wizard) — pensado para que cualquier
 * persona, incluidos adultos mayores, registre su salud con una foto.
 *
 * Flujo: 1) tomar foto / subir archivo → 2) Klinip analiza →
 * 3) resumen amigable con lo detectado y confirmación.
 *
 * Reutiliza el pipeline existente (OCR + extracción) vía:
 *   POST /documents  →  GET /documents/{id}/analysis  →  PUT /documents/{id}
 */

// ─── Branding Klinip ─────────────────────────────────────────────────────────
const BRAND = {
  primary: "#0D47F7",
  primarySoft: "#EAF2FF",
  ink: "#080F19",
  slate: "#334155",
  muted: "#647488",
  green: "#22C55E",
  amber: "#FFB020",
  surface: "#FFFFFF",
  line: "#CDD5E1",
};
const FONT = 'var(--font-brand), "Nunito", system-ui, sans-serif';

const TYPE_LABELS = {
  receta: "una receta",
  orden: "una orden médica",
  resultado: "un resultado de examen",
  informe: "un informe médico",
  otro: "un documento de salud",
};
const TYPE_OPTIONS = [
  { value: "receta", label: "Receta" },
  { value: "orden", label: "Orden médica" },
  { value: "resultado", label: "Resultado de examen" },
  { value: "informe", label: "Informe" },
  { value: "otro", label: "Otro" },
];

const MAX_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 45000;
const ACTIVE_OCR = new Set(["pending", "processing", ""]);

function isOcrActive(status) {
  return ACTIVE_OCR.has(String(status || "").trim().toLowerCase());
}

function entityIcon(entityType) {
  if (entityType === "medication_instruction") return "💊";
  if (entityType === "lab_value") return "🔬";
  if (entityType === "diagnosis") return "🩺";
  return "•";
}

// Marcas suaves (sin alarmismo): solo informamos que conviene revisar.
function flagChip(flag) {
  const f = String(flag || "").toLowerCase();
  if (["high", "low", "critical", "abnormal"].includes(f)) {
    return { text: "Para revisar", color: BRAND.amber };
  }
  if (f === "normal") return { text: "Normal", color: BRAND.green };
  return null;
}

export default function DocumentUploadWizard({ open, onClose, profileId, onUploaded }) {
  const [step, setStep] = useState("choose"); // choose | processing | result | error
  const [analysis, setAnalysis] = useState(null);
  const [docId, setDocId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [editingType, setEditingType] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [histChoice, setHistChoice] = useState(null); // null | "historical" | "activated"
  const [activating, setActivating] = useState(false);

  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const cancelledRef = useRef(false);

  useMobileOverlayLock(open);

  useEffect(() => {
    if (open) {
      cancelledRef.current = false;
      setStep("choose");
      setAnalysis(null);
      setDocId(null);
      setErrorMsg("");
      setEditingType(false);
      setHistChoice(null);
    }
    return () => {
      cancelledRef.current = true;
    };
  }, [open]);

  const pollAnalysis = useCallback(
    async (id) => {
      const startedAt = Date.now();
      // Primer intento inmediato y luego cada POLL_INTERVAL_MS.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelledRef.current) return null;
        let data = null;
        try {
          data = await getDocumentAnalysis(id, profileId);
        } catch (err) {
          // Ignorar errores transitorios y reintentar hasta el timeout.
          data = null;
        }
        if (data && !isOcrActive(data.ocr_status)) return data;
        if (Date.now() - startedAt > POLL_MAX_MS) return data; // devolver lo que haya
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    [profileId],
  );

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (file.size > MAX_BYTES) {
        setErrorMsg("El archivo supera los 10 MB. Toma la foto de nuevo o reduce el tamaño.");
        setStep("error");
        return;
      }
      setStep("processing");
      setErrorMsg("");
      try {
        const created = await uploadDocument({ doc_type: "otro", file });
        const id = created?.id;
        if (!id) throw new Error("upload_no_id");
        setDocId(id);
        if (typeof onUploaded === "function") onUploaded();

        const data = await pollAnalysis(id);
        if (cancelledRef.current) return;
        if (!data) {
          // Se subió, pero el análisis tardó: igual queda guardado.
          setErrorMsg(
            "Tu documento se guardó correctamente. Klinip lo seguirá analizando; podrás verlo en unos momentos.",
          );
          setStep("error");
          return;
        }
        setAnalysis(data);
        setStep("result");
      } catch (err) {
        if (cancelledRef.current) return;
        const status = err?.response?.status;
        if (status === 403) {
          setErrorMsg("Este perfil es de solo lectura. No puedes subir documentos aquí.");
        } else if (status === 401) {
          setErrorMsg("Tu sesión expiró. Vuelve a iniciar sesión e intenta de nuevo.");
        } else {
          setErrorMsg("No pudimos subir el documento. Revisa tu conexión e intenta otra vez.");
        }
        setStep("error");
      }
    },
    [onUploaded, pollAnalysis],
  );

  const handleChangeType = useCallback(
    async (newType) => {
      if (!docId) return;
      setSavingType(true);
      try {
        await updateDocument(docId, { doc_type: newType });
        if (typeof onUploaded === "function") onUploaded();
        const data = await getDocumentAnalysis(docId, profileId);
        setAnalysis(data);
        setEditingType(false);
      } catch (err) {
        setErrorMsg("No pudimos cambiar el tipo. Intenta de nuevo.");
      } finally {
        setSavingType(false);
      }
    },
    [docId, profileId, onUploaded],
  );

  const handleActivate = useCallback(async () => {
    if (!docId) return;
    setActivating(true);
    try {
      await activateDocumentItems(docId);
      if (typeof onUploaded === "function") onUploaded();
      setHistChoice("activated");
    } catch (err) {
      setErrorMsg("No pudimos activar los recordatorios. Intenta de nuevo.");
    } finally {
      setActivating(false);
    }
  }, [docId, onUploaded]);

  if (!open) return null;

  const tipo = analysis?.doc_type || "otro";
  const tipoLabel = TYPE_LABELS[tipo] || TYPE_LABELS.otro;
  const entities = Array.isArray(analysis?.entities) ? analysis.entities : [];
  const friendly = analysis?.summary?.patient_friendly_explanation || "";
  const isHistorical = Boolean(analysis?.is_historical);
  const showHistoricalAsk = isHistorical && histChoice === null && ["receta", "orden"].includes(tipo);

  return createPortal(
    <div style={styles.backdrop} role="dialog" aria-modal="true" aria-label="Asistente de documentos">
      <div style={styles.sheet}>
        <button type="button" onClick={onClose} style={styles.closeBtn} aria-label="Cerrar">
          ✕
        </button>

        {/* Inputs ocultos (cámara y archivo) */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {step === "choose" && (
          <div style={styles.body}>
            <div style={styles.bigIcon}>📄</div>
            <h2 style={styles.title}>Agrega un documento</h2>
            <p style={styles.subtitle}>
              Toma una foto o sube un archivo (receta, orden, examen o informe).
              Klinip lo lee y lo guarda por ti.
            </p>
            <button type="button" style={styles.primaryBtn} onClick={() => cameraInputRef.current?.click()}>
              📷 Tomar una foto
            </button>
            <button type="button" style={styles.secondaryBtn} onClick={() => fileInputRef.current?.click()}>
              📁 Subir un archivo
            </button>
          </div>
        )}

        {step === "processing" && (
          <div style={styles.body}>
            <div style={styles.spinner} />
            <h2 style={styles.title}>Analizando tu documento…</h2>
            <p style={styles.subtitle}>
              Estoy leyendo lo que dice. Esto toma unos segundos, quédate en esta pantalla.
            </p>
          </div>
        )}

        {step === "result" && (
          <div style={styles.body}>
            <div style={styles.bigIcon}>✅</div>
            <h2 style={styles.title}>Guardado</h2>
            <p style={styles.subtitle}>
              Esto parece <strong>{tipoLabel}</strong>.
            </p>

            {entities.length > 0 && (
              <div style={styles.card}>
                <div style={styles.cardLabel}>Esto fue lo que entendí:</div>
                <ul style={styles.list}>
                  {entities.slice(0, 8).map((ent) => {
                    const chip = flagChip(ent.flag);
                    return (
                      <li key={ent.id} style={styles.listItem}>
                        <span style={styles.entIcon}>{entityIcon(ent.entity_type)}</span>
                        <span style={styles.entName}>
                          {ent.entity_name}
                          {ent.entity_value ? ` · ${ent.entity_value}` : ""}
                          {ent.unit ? ` ${ent.unit}` : ""}
                        </span>
                        {chip && (
                          <span style={{ ...styles.chip, color: chip.color, borderColor: chip.color }}>
                            {chip.text}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {friendly && <p style={styles.friendly}>{friendly}</p>}

            {showHistoricalAsk ? (
              <div style={styles.card}>
                <div style={styles.cardLabel}>📅 Parece de tu historial</div>
                <p style={styles.friendly}>
                  Este documento es de hace un tiempo. Lo guardé en tu historial y la IA lo
                  usará como contexto. ¿Es un {tipo === "receta" ? "tratamiento" : "trámite"} vigente?
                </p>
                <button
                  type="button"
                  style={styles.primaryBtn}
                  disabled={activating}
                  onClick={handleActivate}
                >
                  {activating
                    ? "Activando…"
                    : tipo === "receta"
                    ? "Sí, está vigente — activar recordatorios"
                    : "Sí, está vigente — agendar la cita"}
                </button>
                <button
                  type="button"
                  style={styles.secondaryBtn}
                  onClick={() => setHistChoice("historical")}
                >
                  No, solo guardar en mi historial
                </button>
              </div>
            ) : (
              <>
                {histChoice === "activated" && (
                  <p style={styles.friendly}>
                    ✓ Listo. Activé los {tipo === "receta" ? "recordatorios" : "datos de la cita"} de este documento.
                  </p>
                )}
                {histChoice === "historical" && (
                  <p style={styles.friendly}>
                    ✓ Guardado en tu historial. La IA lo usará como contexto, sin recordatorios.
                  </p>
                )}
                {!editingType ? (
                  <>
                    <button type="button" style={styles.primaryBtn} onClick={onClose}>
                      Sí, está bien
                    </button>
                    <button
                      type="button"
                      style={styles.linkBtn}
                      onClick={() => setEditingType(true)}
                    >
                      No es {tipoLabel} — cambiar tipo
                    </button>
                  </>
                ) : (
                  <div style={styles.card}>
                    <div style={styles.cardLabel}>¿Qué tipo de documento es?</div>
                    <div style={styles.typeGrid}>
                      {TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={savingType}
                          style={{
                            ...styles.typeBtn,
                            ...(opt.value === tipo ? styles.typeBtnActive : {}),
                          }}
                          onClick={() => handleChangeType(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === "error" && (
          <div style={styles.body}>
            <div style={styles.bigIcon}>📄</div>
            <h2 style={styles.title}>Listo</h2>
            <p style={styles.subtitle}>{errorMsg}</p>
            <button type="button" style={styles.primaryBtn} onClick={onClose}>
              Entendido
            </button>
            <button type="button" style={styles.secondaryBtn} onClick={() => setStep("choose")}>
              Subir otro documento
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(8, 15, 25, 0.55)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 9999,
    fontFamily: FONT,
  },
  sheet: {
    position: "relative",
    width: "100%",
    maxWidth: 480,
    background: BRAND.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderRadius: 28,
    margin: "auto 12px 12px",
    padding: "28px 22px 26px",
    boxShadow: "0 -8px 40px rgba(8,15,25,0.25)",
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 999,
    border: "none",
    background: BRAND.primarySoft,
    color: BRAND.primary,
    fontSize: 18,
    cursor: "pointer",
    fontFamily: FONT,
  },
  body: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 },
  bigIcon: { fontSize: 52, lineHeight: 1, marginTop: 6 },
  title: { fontSize: 24, fontWeight: 800, color: BRAND.ink, margin: 0 },
  subtitle: { fontSize: 17, color: BRAND.muted, margin: 0, lineHeight: 1.45 },
  primaryBtn: {
    width: "100%",
    minHeight: 58,
    borderRadius: 18,
    border: "none",
    background: BRAND.primary,
    color: "#fff",
    fontSize: 19,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: FONT,
    marginTop: 6,
  },
  secondaryBtn: {
    width: "100%",
    minHeight: 58,
    borderRadius: 18,
    border: `2px solid ${BRAND.primary}`,
    background: "#fff",
    color: BRAND.primary,
    fontSize: 19,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: FONT,
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: BRAND.muted,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: FONT,
    textDecoration: "underline",
  },
  card: {
    width: "100%",
    background: "#F5F7FA",
    borderRadius: 18,
    padding: "16px 16px",
    textAlign: "left",
  },
  cardLabel: { fontSize: 15, fontWeight: 800, color: BRAND.slate, marginBottom: 10 },
  list: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 },
  listItem: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  entIcon: { fontSize: 20 },
  entName: { fontSize: 17, color: BRAND.ink, fontWeight: 700, flex: 1 },
  chip: {
    fontSize: 13,
    fontWeight: 800,
    border: "1.5px solid",
    borderRadius: 999,
    padding: "2px 10px",
    background: "#fff",
  },
  friendly: { fontSize: 15, color: BRAND.muted, margin: 0, lineHeight: 1.5 },
  typeGrid: { display: "flex", flexDirection: "column", gap: 8 },
  typeBtn: {
    width: "100%",
    minHeight: 50,
    borderRadius: 14,
    border: `2px solid ${BRAND.line}`,
    background: "#fff",
    color: BRAND.slate,
    fontSize: 17,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: FONT,
  },
  typeBtnActive: {
    borderColor: BRAND.primary,
    color: BRAND.primary,
    background: BRAND.primarySoft,
  },
  spinner: {
    width: 52,
    height: 52,
    borderRadius: "50%",
    border: `5px solid ${BRAND.primarySoft}`,
    borderTopColor: BRAND.primary,
    animation: "klinipSpin 0.9s linear infinite",
    marginTop: 6,
  },
};
