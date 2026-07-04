import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  activateDocumentItems,
  getDocumentAnalysis,
  updateDocument,
  uploadDocument,
} from "../services/httpApi";
import SuccessSheet from "./SuccessSheet";
import useMobileOverlayLock from "../hooks/useMobileOverlayLock";
import { cleanUiText } from "../utils/textEncoding";
import { buildCoverageNotes, COVERAGE_UPLOAD_INTENT } from "../utils/coverageDocuments";

const MAX_BYTES = 10 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_MS = 45000;
const ACTIVE_OCR = new Set(["pending", "processing", ""]);
const LIVE_CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

const TYPE_COPY = {
  receta: {
    article: "una receta",
    short: "Receta",
    confirm:
      "Klinip puede convertir esta receta en un tratamiento más fácil de seguir.",
    next:
      "Luego podrás revisar medicamentos, recordatorios y continuidad desde un solo lugar.",
  },
  orden: {
    article: "una orden médica",
    short: "Orden médica",
    confirm:
      "Klinip puede dejar esta orden lista para revisar citas, exámenes o próximos pasos.",
    next:
      "Luego podrás revisar si corresponde activar una cita o mantenerla solo como respaldo.",
  },
  resultado: {
    article: "un resultado de examen",
    short: "Resultado",
    confirm:
      "Klinip puede resumir este examen en lenguaje simple y dejarlo visible para futuras consultas.",
    next:
      "Luego podrás revisar valores destacados y usar el resumen como contexto clínico.",
  },
  informe: {
    article: "un informe médico",
    short: "Informe",
    confirm:
      "Klinip puede resumir este informe y dejar los hallazgos más importantes a la vista.",
    next:
      "Luego podrás revisarlo con más contexto desde tus documentos.",
  },
  otro: {
    article: "un documento de salud",
    short: "Documento",
    confirm:
      "Klinip lo guardará y usará la lectura automática como apoyo para entenderlo mejor.",
    next: "Luego podrás reclasificarlo si corresponde.",
  },
};

const TYPE_OPTIONS = [
  { value: "receta", label: "Receta" },
  { value: "orden", label: "Orden médica" },
  { value: "resultado", label: "Resultado de examen" },
  { value: "informe", label: "Informe médico" },
  { value: "otro", label: "Otro documento" },
];

const UPLOAD_INTENTS = [
  {
    value: "auto",
    label: "Salud general",
    helper: "Recetas, órdenes, resultados, informes u otros documentos clínicos.",
  },
  {
    value: COVERAGE_UPLOAD_INTENT,
    label: "Cobertura / seguro",
    helper: "Bonos, reembolsos, licencias, GES/CAEC, copagos o plan de salud.",
  },
];

const CAPTURE_TIPS = [
  "Incluye el documento completo dentro de la foto.",
  "Evita sombras, reflejos y fondos recargados.",
  "Acércate hasta que el texto principal se vea legible.",
  "Si son varias hojas, súbelas en PDF cuando puedas.",
];

// Guía en vivo de captura: se analiza un cuadro reducido del video cada pocos
// milisegundos para orientar al usuario (luz, nitidez, encuadre, pulso) y
// disparar la captura automática cuando la escena se mantiene estable.
const LIVE_ANALYSIS_INTERVAL_MS = 400;
const LIVE_ANALYSIS_WIDTH = 96;
const AUTO_CAPTURE_READY_TICKS = 3;

function analyzeVideoFrame(video, canvas, prevGray) {
  const aspect = video.videoHeight / video.videoWidth || 1.33;
  const width = LIVE_ANALYSIS_WIDTH;
  const height = Math.max(32, Math.round(width * aspect));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  let pixels;
  try {
    pixels = context.getImageData(0, 0, width, height).data;
  } catch (_) {
    return null;
  }

  const total = width * height;
  const gray = new Float32Array(total);
  let lumaSum = 0;
  for (let i = 0; i < total; i += 1) {
    const offset = i * 4;
    const luma = pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
    gray[i] = luma;
    lumaSum += luma;
  }

  // Nitidez (varianza del laplaciano) y densidad de bordes en la zona central,
  // donde el marco guía sugiere apoyar el documento. Un documento con texto
  // genera muchos bordes; una pared o escena vacía casi ninguno.
  let lapSum = 0;
  let lapCount = 0;
  let innerEdges = 0;
  let innerCount = 0;
  const innerX0 = Math.round(width * 0.14);
  const innerX1 = Math.round(width * 0.86);
  const innerY0 = Math.round(height * 0.12);
  const innerY1 = Math.round(height * 0.88);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const lap = gray[i] * 4 - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      lapSum += lap * lap;
      lapCount += 1;
      if (x >= innerX0 && x < innerX1 && y >= innerY0 && y < innerY1) {
        innerCount += 1;
        if (Math.abs(lap) > 24) innerEdges += 1;
      }
    }
  }

  let motion = 0;
  if (prevGray && prevGray.length === gray.length) {
    let diff = 0;
    let samples = 0;
    for (let i = 0; i < total; i += 4) {
      diff += Math.abs(gray[i] - prevGray[i]);
      samples += 1;
    }
    motion = diff / Math.max(1, samples);
  }

  return {
    gray,
    meanLuma: lumaSum / total,
    sharpness: lapSum / Math.max(1, lapCount),
    innerEdgeRatio: innerEdges / Math.max(1, innerCount),
    motion,
    hasPrevFrame: Boolean(prevGray),
  };
}

function buildLiveCaptureHint(metrics) {
  if (metrics.meanLuma < 60) {
    return { tone: "warn", ready: false, message: "Hay poca luz. Busca más iluminación o acércate a una lámpara." };
  }
  if (metrics.meanLuma > 218) {
    return { tone: "warn", ready: false, message: "Hay demasiada luz o reflejos. Inclina un poco el documento." };
  }
  if (metrics.innerEdgeRatio < 0.012) {
    return { tone: "info", ready: false, message: "Apunta al documento y acércate hasta que llene el marco." };
  }
  if (metrics.hasPrevFrame && metrics.motion > 8) {
    return { tone: "info", ready: false, message: "Mantén el teléfono firme…" };
  }
  if (metrics.sharpness < 100) {
    return { tone: "info", ready: false, message: "Enfocando… acerca o aleja un poco el teléfono." };
  }
  return { tone: "ok", ready: true, message: "¡Se ve bien! Mantén la posición." };
}

function isOcrActive(status) {
  return ACTIVE_OCR.has(String(status || "").trim().toLowerCase());
}

function getTypeCopy(type) {
  return TYPE_COPY[type] || TYPE_COPY.otro;
}

function getFriendlyTypeLabel(type) {
  return getTypeCopy(type).short;
}

function buildEntityGroups(entities) {
  const groups = {
    medication_instruction: [],
    lab_value: [],
    diagnosis: [],
    other: [],
  };

  (Array.isArray(entities) ? entities : []).forEach((entity) => {
    const key = groups[entity?.entity_type] ? entity.entity_type : "other";
    groups[key].push(entity);
  });

  return groups;
}

function buildSuggestedActions({ type, isHistorical, entities, requiresReview }) {
  const meds = entities.medication_instruction.length;
  const labs = entities.lab_value.length;
  const diagnoses = entities.diagnosis.length;

  if (isHistorical && type === "receta") {
    return [
      "Puedes dejarla solo como respaldo o activar el tratamiento si sigue vigente.",
      "Si la activas, Klinip podrá usarla para continuidad y recordatorios.",
    ];
  }

  if (isHistorical && type === "orden") {
    return [
      "Puedes dejarla como respaldo o activar la orden si aún necesitas ese control.",
      "Si la activas, Klinip podrá usarla para seguimiento de la próxima cita o examen.",
    ];
  }

  if (type === "receta") {
    return [
      meds
        ? `Detecté ${meds} indicación${meds === 1 ? "" : "es"} de medicamento para revisar.`
        : "Klinip intentará convertir esta receta en un tratamiento más fácil de seguir.",
      "Después podrás revisar dosis, frecuencia y recordatorios desde Medicamentos.",
    ];
  }

  if (type === "orden") {
    return [
      "Klinip dejará esta orden lista para seguir el próximo paso clínico asociado.",
      "Después podrás revisar si corresponde una cita, un examen o solo dejarla como respaldo.",
    ];
  }

  if (type === "resultado") {
    return [
      labs
        ? `Detecté ${labs} valor${labs === 1 ? "" : "es"} legible${labs === 1 ? "" : "s"} para revisar.`
        : "Klinip resumirá el examen con lo más importante en lenguaje simple.",
      requiresReview
        ? "Hay datos que conviene revisar antes de tomar decisiones con este resultado."
        : "Después podrás revisar valores destacados y usar este resultado como contexto clínico.",
    ];
  }

  if (type === "informe") {
    return [
      diagnoses
        ? `Detecté ${diagnoses} hallazgo${diagnoses === 1 ? "" : "s"} o impresión${diagnoses === 1 ? "" : "es"} clínica${diagnoses === 1 ? "" : "s"} para resumir.`
        : "Klinip usará este informe para resumir los hallazgos más relevantes.",
      "Después podrás revisarlo con una lectura más clara dentro de tus documentos.",
    ];
  }

  if (type === "cobertura") {
    return [
      "Klinip lo guardará como documento de cobertura para bonos, reembolsos, licencias o copagos.",
      "Después aparecerá en Klinip Cobertura para revisar señales de Isapre, Fonasa, seguro o prestador.",
    ];
  }

  return [
    "Klinip guardará el documento y mantendrá esta lectura disponible como contexto clínico.",
    "Si el tipo no coincide, puedes corregirlo antes de cerrar.",
  ];
}

function formatEntityPrimary(entity) {
  const name = cleanUiText(entity?.entity_name, "").trim();
  const value = cleanUiText(entity?.entity_value, "").trim();
  const unit = cleanUiText(entity?.unit, "").trim();
  const combinedValue = [value, unit].filter(Boolean).join(" ").trim();
  return [name, combinedValue].filter(Boolean).join(": ").trim() || "Dato detectado";
}

function formatEntitySecondary(entity) {
  const parts = [];
  const range = cleanUiText(entity?.reference_range, "").trim();
  const flag = cleanUiText(entity?.flag, "").trim();
  if (range) parts.push(`Referencia ${range}`);
  if (flag && !["normal", "unknown"].includes(flag.toLowerCase())) parts.push("Conviene revisarlo");
  return parts.join(" · ");
}

function buildSuccessCopy(type, histChoice) {
  if (histChoice === "activated") {
    return "El documento quedó guardado y también activado para tu seguimiento actual.";
  }
  if (histChoice === "historical") {
    return "El documento quedó guardado como parte de tu historial de salud.";
  }
  if (type === "receta") {
    return "La receta quedó guardada y lista para apoyar el seguimiento de tu tratamiento.";
  }
  if (type === "orden") {
    return "La orden quedó guardada y lista para apoyar tus próximos pasos clínicos.";
  }
  if (type === "resultado") {
    return "El resultado quedó guardado y listo para resumirse con una lectura más simple.";
  }
  if (type === "informe") {
    return "El informe quedó guardado y listo para consultarlo con más contexto.";
  }
  if (type === "cobertura") {
    return "El documento de cobertura quedó guardado para revisar bonos, reembolsos, licencias o copagos.";
  }
  return "El documento quedó guardado y ya forma parte de tu seguimiento clínico.";
}

function getCameraErrorMessage(error) {
  const errorName = String(error?.name || "");
  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    return "No pudimos abrir la cámara en vivo porque el permiso fue rechazado. Puedes autorizarlo o usar la cámara del dispositivo.";
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No encontramos una cámara disponible en este dispositivo. Usa la carga por archivo para continuar.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "La cámara está siendo usada por otra aplicación. Ciérrala allí o usa la carga por archivo.";
  }
  return "No pudimos iniciar la cámara en vivo. Puedes reintentar o usar la cámara del dispositivo como respaldo.";
}

export default function DocumentUploadWizard({ open, onClose, profileId, onUploaded }) {
  const [step, setStep] = useState("choose");
  const [analysis, setAnalysis] = useState(null);
  const [docId, setDocId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [editingType, setEditingType] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [histChoice, setHistChoice] = useState(null);
  const [activating, setActivating] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [uploadIntent, setUploadIntent] = useState("auto");
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [autoCapture, setAutoCapture] = useState(true);
  const [liveHint, setLiveHint] = useState(null);

  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const cancelledRef = useRef(false);
  const analysisCanvasRef = useRef(null);
  const prevFrameRef = useRef(null);
  const readyTicksRef = useRef(0);
  const autoCapturedRef = useRef(false);

  const cameraSupported = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  }, []);

  useMobileOverlayLock(open);

  const stopCameraStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause?.();
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraBusy(false);
  }, []);

  useEffect(() => {
    if (open) {
      cancelledRef.current = false;
      setStep("choose");
      setAnalysis(null);
      setDocId(null);
      setErrorMsg("");
      setEditingType(false);
      setSavingType(false);
      setHistChoice(null);
      setActivating(false);
      setDoneOpen(false);
      setSelectedFileName("");
      setSelectedSource("");
      setUploadIntent("auto");
      setCameraError("");
      setCameraReady(false);
      setCameraBusy(false);
    } else {
      stopCameraStream();
    }

    return () => {
      cancelledRef.current = true;
      stopCameraStream();
    };
  }, [open, stopCameraStream]);

  const pollAnalysis = useCallback(
    async (id) => {
      const startedAt = Date.now();
      while (true) {
        if (cancelledRef.current) return null;
        let data = null;
        try {
          data = await getDocumentAnalysis(id, profileId);
        } catch (_) {
          data = null;
        }
        if (data && !isOcrActive(data.ocr_status)) return data;
        if (Date.now() - startedAt > POLL_MAX_MS) return data;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    [profileId],
  );

  const handleFile = useCallback(
    async (file, source = "") => {
      if (!file) return;
      stopCameraStream();
      setSelectedFileName(String(file.name || "documento"));
      setSelectedSource(source);
      if (file.size > MAX_BYTES) {
        setErrorMsg("El archivo supera los 10 MB. Toma la foto de nuevo o sube una versión más liviana.");
        setStep("error");
        return;
      }
      setStep("processing");
      setErrorMsg("");
      try {
        const created = await uploadDocument({
          doc_type: "otro",
          notes: uploadIntent === COVERAGE_UPLOAD_INTENT ? buildCoverageNotes("") : "",
          file,
        });
        const id = created?.id;
        if (!id) throw new Error("upload_no_id");
        setDocId(id);
        onUploaded?.();

        const data = await pollAnalysis(id);
        if (cancelledRef.current) return;
        if (!data) {
          setErrorMsg(
            "Tu documento se guardó correctamente. Klinip seguirá leyéndolo en segundo plano y aparecerá en Documentos en unos momentos.",
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
          setErrorMsg("Este perfil está en modo solo lectura. No puedes subir documentos aquí.");
        } else if (status === 401) {
          setErrorMsg("Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.");
        } else {
          setErrorMsg("No pudimos subir el documento. Revisa tu conexión e inténtalo otra vez.");
        }
        setStep("error");
      }
    },
    [onUploaded, pollAnalysis, stopCameraStream, uploadIntent],
  );

  const startCameraPreview = useCallback(async () => {
    if (!cameraSupported) {
      setCameraError("La vista previa en vivo no está disponible aquí. Puedes usar la cámara del dispositivo como respaldo.");
      return;
    }

    stopCameraStream();
    setCameraError("");
    setCameraBusy(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(LIVE_CAMERA_CONSTRAINTS);
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      stopCameraStream();
      setCameraError(getCameraErrorMessage(error));
    } finally {
      setCameraBusy(false);
    }
  }, [cameraSupported, stopCameraStream]);

  useEffect(() => {
    if (!open || step !== "camera") {
      stopCameraStream();
      return undefined;
    }

    startCameraPreview();
    return () => stopCameraStream();
  }, [open, startCameraPreview, step, stopCameraStream]);

  const handleOpenLiveCamera = useCallback(() => {
    setCameraError("");
    if (!cameraSupported) {
      cameraInputRef.current?.click();
      return;
    }
    setStep("camera");
  }, [cameraSupported]);

  const handleDeviceCameraFallback = useCallback(() => {
    stopCameraStream();
    cameraInputRef.current?.click();
  }, [stopCameraStream]);

  const handleLibraryFallback = useCallback(() => {
    stopCameraStream();
    fileInputRef.current?.click();
  }, [stopCameraStream]);

  const handleCaptureFrame = useCallback(async () => {
    if (cameraBusy) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError("Aún no hay una imagen lista para capturar. Espera un momento o vuelve a intentarlo.");
      return;
    }

    setCameraBusy(true);
    setCameraError("");

    try {
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));

      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("canvas_context_unavailable");

      context.drawImage(video, 0, 0, width, height);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (value) => {
            if (value) {
              resolve(value);
            } else {
              reject(new Error("capture_failed"));
            }
          },
          "image/jpeg",
          0.92,
        );
      });

      const file = new File([blob], `captura-klinip-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      await handleFile(file, "live-camera");
    } catch (_) {
      setCameraError("No pudimos capturar la foto. Reintenta o usa la cámara del dispositivo.");
    } finally {
      setCameraBusy(false);
    }
  }, [cameraBusy, handleFile]);

  useEffect(() => {
    if (!open || step !== "camera" || !cameraReady || cameraBusy || cameraError) {
      prevFrameRef.current = null;
      readyTicksRef.current = 0;
      setLiveHint(null);
      return undefined;
    }

    autoCapturedRef.current = false;
    if (!analysisCanvasRef.current && typeof document !== "undefined") {
      analysisCanvasRef.current = document.createElement("canvas");
    }

    const applyHint = (next) =>
      setLiveHint((prev) =>
        prev && prev.message === next.message && prev.ready === next.ready ? prev : next,
      );

    const intervalId = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = analysisCanvasRef.current;
      if (!video || !canvas || !video.videoWidth || video.readyState < 2) return;
      if (autoCapturedRef.current) return;

      const metrics = analyzeVideoFrame(video, canvas, prevFrameRef.current);
      if (!metrics) return;
      prevFrameRef.current = metrics.gray;

      const hint = buildLiveCaptureHint(metrics);
      if (!hint.ready) {
        readyTicksRef.current = 0;
        applyHint(hint);
        return;
      }

      readyTicksRef.current += 1;
      if (!autoCapture) {
        applyHint({ ...hint, message: "¡Se ve bien! Presiona Capturar foto." });
        return;
      }
      if (readyTicksRef.current >= AUTO_CAPTURE_READY_TICKS) {
        autoCapturedRef.current = true;
        applyHint({ ...hint, message: "¡Se ve bien! Capturando…" });
        handleCaptureFrame();
      } else {
        applyHint({ ...hint, message: "¡Se ve bien! Mantén la posición…" });
      }
    }, LIVE_ANALYSIS_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [open, step, cameraReady, cameraBusy, cameraError, autoCapture, handleCaptureFrame]);

  const handleChangeType = useCallback(
    async (newType) => {
      if (!docId) return;
      setSavingType(true);
      try {
        await updateDocument(docId, { doc_type: newType });
        onUploaded?.();
        const data = await getDocumentAnalysis(docId, profileId);
        setAnalysis(data);
        setEditingType(false);
      } catch (_) {
        setErrorMsg("No pudimos cambiar el tipo. Intenta de nuevo.");
        setStep("error");
      } finally {
        setSavingType(false);
      }
    },
    [docId, onUploaded, profileId],
  );

  const handleActivate = useCallback(async () => {
    if (!docId) return;
    setActivating(true);
    try {
      await activateDocumentItems(docId);
      onUploaded?.();
      setHistChoice("activated");
    } catch (_) {
      setErrorMsg("No pudimos activar este documento para tu seguimiento actual. Intenta de nuevo.");
      setStep("error");
    } finally {
      setActivating(false);
    }
  }, [docId, onUploaded]);

  const handleConfirmResult = useCallback(() => {
    setDoneOpen(true);
  }, []);

  const handleCloseWizard = useCallback(() => {
    if (step === "processing") return;
    stopCameraStream();
    onClose?.();
  }, [onClose, step, stopCameraStream]);

  const analysisType = analysis?.doc_type || "otro";
  const typeCopy = getTypeCopy(analysisType);
  const isCoverageUpload = uploadIntent === COVERAGE_UPLOAD_INTENT;
  const displayType = isCoverageUpload ? "cobertura" : analysisType;
  const entities = useMemo(() => buildEntityGroups(analysis?.entities || []), [analysis?.entities]);
  const totalEntities = (analysis?.entities || []).length;
  const isCameraSource = selectedSource === "camera" || selectedSource === "live-camera";
  const friendlyExplanation = cleanUiText(
    analysis?.summary?.patient_friendly_explanation ||
      analysis?.summary?.summary_plain ||
      typeCopy.confirm,
    typeCopy.confirm,
  );
  const requiresReview = Boolean(analysis?.summary?.requires_review);
  const isHistorical = Boolean(analysis?.is_historical);
  const showHistoricalAsk = isHistorical && histChoice === null && ["receta", "orden"].includes(analysisType);
  const suggestedActions = useMemo(
    () =>
        buildSuggestedActions({
          type: isCoverageUpload ? "cobertura" : analysisType,
          isHistorical,
          entities,
          requiresReview,
        }),
    [analysisType, entities, isCoverageUpload, isHistorical, requiresReview],
  );

  const keyPoints = Array.isArray(analysis?.summary?.key_points_json)
    ? analysis.summary.key_points_json.map((item) => cleanUiText(item).trim()).filter(Boolean)
    : [];

  const centerVal =
    keyPoints.find((item) => item.toLowerCase().startsWith("centro:"))?.split(":").slice(1).join(":").trim() || "";
  const dateVal =
    keyPoints.find((item) => item.toLowerCase().startsWith("fecha:"))?.split(":").slice(1).join(":").trim() || "";

  if (!open) return null;

  return (
    <>
      {createPortal(
        <div className="documents-wizard-backdrop" role="dialog" aria-modal="true" aria-label="Asistente para documentos">
          <div className="documents-wizard-shell">
            <button
              type="button"
              className="documents-wizard-close"
              onClick={handleCloseWizard}
              aria-label="Cerrar"
            >
              ×
            </button>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                handleFile(file, "camera");
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                handleFile(file, "file");
              }}
            />

            {step === "choose" ? (
              <div className="documents-wizard-body">
                <div className="documents-wizard-hero">
                  <span className="documents-wizard-kicker">Klinip IA</span>
                  <h2>Saca una foto y deja que Klinip haga el resto</h2>
                  <p>Klinip la lee, la clasifica y la guarda en tu perfil con una lectura simple.</p>
                </div>

                <div className="documents-wizard-intent-grid" aria-label="Intención de subida">
                  {UPLOAD_INTENTS.map((intent) => (
                    <button
                      key={intent.value}
                      type="button"
                      className={`documents-wizard-intent-btn${uploadIntent === intent.value ? " is-active" : ""}`}
                      onClick={() => setUploadIntent(intent.value)}
                      aria-pressed={uploadIntent === intent.value}
                    >
                      <strong>{intent.label}</strong>
                      <span>{intent.helper}</span>
                    </button>
                  ))}
                </div>

                <div className="documents-wizard-button-stack">
                  <button
                    type="button"
                    className="primary-btn documents-wizard-main-btn"
                    onClick={handleOpenLiveCamera}
                  >
                    <span aria-hidden>📷</span> Tomar una foto
                  </button>
                  <button
                    type="button"
                    className="secondary-btn documents-wizard-main-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span aria-hidden>📄</span> Subir PDF o imagen
                  </button>
                </div>

                {!cameraSupported ? (
                  <div className="documents-wizard-source-note">
                    En este navegador se abrirá la cámara del dispositivo, porque la vista previa en vivo no está
                    disponible.
                  </div>
                ) : null}

                <details className="documents-wizard-tips">
                  <summary>Consejos para una foto clara</summary>
                  <ul className="documents-wizard-checklist">
                    {CAPTURE_TIPS.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : null}

            {step === "camera" ? (
              <div className="documents-wizard-body">
                <div className="documents-wizard-camera-shell">
                  <div className="documents-wizard-camera-stage">
                    <video
                      ref={videoRef}
                      className="documents-wizard-camera-video"
                      autoPlay
                      muted
                      playsInline
                    />
                    <div className="documents-wizard-camera-mask" aria-hidden="true">
                      <div
                        className={`documents-wizard-camera-frame${liveHint?.ready ? " is-ready" : ""}`}
                      />
                    </div>
                    <div
                      className={`documents-wizard-camera-status${
                        cameraError
                          ? " is-error"
                          : liveHint?.ready
                          ? " is-ready"
                          : liveHint?.tone === "warn"
                          ? " is-warn"
                          : ""
                      }`}
                      aria-live="polite"
                    >
                      {cameraError
                        ? cameraError
                        : liveHint?.message
                        ? liveHint.message
                        : cameraReady
                        ? "Encuadra el documento dentro del marco"
                        : "Abriendo cámara..."}
                    </div>
                  </div>

                  <canvas ref={canvasRef} className="documents-wizard-hidden-canvas" aria-hidden="true" />
                </div>

                <button
                  type="button"
                  className={`documents-wizard-autocapture-toggle${autoCapture ? " is-on" : ""}`}
                  onClick={() => setAutoCapture((value) => !value)}
                  aria-pressed={autoCapture}
                >
                  <span className="documents-wizard-autocapture-dot" aria-hidden />
                  {autoCapture
                    ? "Captura automática activada: la foto se toma sola cuando se vea bien"
                    : "Captura automática desactivada"}
                </button>

                <div className="documents-wizard-button-stack">
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={cameraBusy || !cameraReady}
                    onClick={handleCaptureFrame}
                  >
                    {cameraBusy ? "Preparando captura..." : "Capturar foto"}
                  </button>
                  <button type="button" className="secondary-btn" onClick={handleDeviceCameraFallback}>
                    Usar cámara del dispositivo
                  </button>
                </div>

                <div className="documents-wizard-inline-actions">
                  {cameraError ? (
                    <button type="button" className="documents-wizard-inline-action" onClick={startCameraPreview}>
                      Reintentar cámara
                    </button>
                  ) : null}
                  <button type="button" className="documents-wizard-inline-action" onClick={handleLibraryFallback}>
                    Subir archivo
                  </button>
                  <button type="button" className="documents-wizard-inline-action" onClick={() => setStep("choose")}>
                    Volver
                  </button>
                </div>
              </div>
            ) : null}

            {step === "processing" ? (
              <div className="documents-wizard-body">
                <div className="documents-wizard-processing-spinner" aria-hidden="true" />
                <div className="documents-wizard-hero is-centered">
                  <span className="documents-wizard-kicker">Leyendo tu documento</span>
                  <h2>Klinip está organizando lo importante</h2>
                  <p>
                    {selectedFileName ? `Archivo: ${selectedFileName}. ` : ""}
                    {isCameraSource
                      ? "Estoy leyendo la foto y tratando de entender el tipo de documento, el contenido principal y los próximos pasos."
                      : "Estoy leyendo el archivo y tratando de entender el tipo de documento, el contenido principal y los próximos pasos."}
                  </p>
                </div>

                <div className="documents-wizard-progress-list">
                  <article className="documents-wizard-progress-card is-active">
                    <strong>1. Guardado seguro</strong>
                    <span>El archivo ya quedó asociado a tu perfil de salud.</span>
                  </article>
                  <article className="documents-wizard-progress-card is-active">
                    <strong>2. Lectura automática</strong>
                    <span>Klinip está leyendo texto, fecha, centro y tipo de documento.</span>
                  </article>
                  <article className="documents-wizard-progress-card">
                    <strong>3. Confirmación simple</strong>
                    <span>Te mostraré solo lo necesario para confirmar antes de cerrar.</span>
                  </article>
                </div>
              </div>
            ) : null}

            {step === "result" ? (
              <div className="documents-wizard-body">
                <div className="documents-wizard-hero">
                  <span className="documents-wizard-kicker">Lectura lista</span>
                  <h2>Klinip cree que es {typeCopy.article}</h2>
                  <p>{friendlyExplanation}</p>
                </div>

                <div className="documents-wizard-summary-bar">
                  <span className="documents-wizard-summary-chip">
                    {isCoverageUpload ? "Cobertura / seguro" : getFriendlyTypeLabel(analysisType)}
                  </span>
                  <span className="documents-wizard-summary-chip is-muted">
                    {totalEntities > 0
                      ? `${totalEntities} dato${totalEntities === 1 ? "" : "s"} detectado${totalEntities === 1 ? "" : "s"}`
                      : "Sin datos estructurados"}
                  </span>
                  {requiresReview ? (
                    <span className="documents-wizard-summary-chip is-warning">Conviene revisarlo</span>
                  ) : null}
                </div>

                {keyPoints.length ? (
                  <div className="documents-wizard-section">
                    <div className="documents-wizard-section-head">
                      <strong>Resumen rápido</strong>
                      <span>Lo más útil a primera vista.</span>
                    </div>
                    <ul className="documents-wizard-checklist is-compact">
                      {keyPoints.slice(0, 4).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {totalEntities > 0 ? (
                  <div className="documents-wizard-section">
                    <div className="documents-wizard-section-head">
                      <strong>Esto fue lo que entendí</strong>
                      <span>Solo los datos más visibles.</span>
                    </div>
                    <div className="documents-wizard-entity-grid">
                      {[
                        {
                          key: "medication_instruction",
                          title: "Tratamientos o indicaciones",
                          items: entities.medication_instruction,
                        },
                        {
                          key: "lab_value",
                          title: "Valores de examen",
                          items: entities.lab_value,
                        },
                        {
                          key: "diagnosis",
                          title: "Hallazgos o impresiones",
                          items: entities.diagnosis,
                        },
                      ]
                        .filter((group) => group.items.length)
                        .map((group) => (
                          <article key={group.key} className="documents-wizard-entity-card">
                            <strong>{group.title}</strong>
                            <ul>
                              {group.items.slice(0, 4).map((entity) => (
                                <li key={entity.id}>
                                  <span>{formatEntityPrimary(entity)}</span>
                                  {formatEntitySecondary(entity) ? (
                                    <small>{formatEntitySecondary(entity)}</small>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </article>
                        ))}
                    </div>
                  </div>
                ) : null}

                <div className="documents-wizard-section">
                  <div className="documents-wizard-section-head">
                    <strong>Qué pasará después</strong>
                    <span>Para que no tengas que adivinar el siguiente paso.</span>
                  </div>
                  <div className="documents-wizard-action-list">
                    {suggestedActions.map((item) => (
                      <article key={item} className="documents-wizard-action-card">
                        <span>{item}</span>
                      </article>
                    ))}
                  </div>
                </div>

                {showHistoricalAsk ? (
                  <div className="documents-wizard-section is-highlight">
                    <div className="documents-wizard-section-head">
                      <strong>Parece parte de tu historial</strong>
                      <span>Klinip ya lo guardó. Solo necesito saber si sigue vigente.</span>
                    </div>
                    <p className="documents-wizard-helper">
                      {analysisType === "receta"
                        ? "Si este tratamiento sigue vigente, puedo dejarlo activo para continuidad y recordatorios."
                        : "Si esta orden sigue vigente, puedo dejarla activa para el seguimiento actual."}
                    </p>
                    <div className="documents-wizard-button-stack">
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={activating}
                        onClick={handleActivate}
                      >
                        {activating
                          ? "Activando..."
                          : analysisType === "receta"
                          ? "Sí, sigue vigente"
                          : "Sí, aún corresponde"}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => setHistChoice("historical")}
                      >
                        Guardarlo solo como historial
                      </button>
                    </div>
                  </div>
                ) : null}

                {!showHistoricalAsk && histChoice === "activated" ? (
                  <div className="documents-wizard-inline-notice is-success">
                    Klinip dejó este documento activo para tu seguimiento actual.
                  </div>
                ) : null}

                {!showHistoricalAsk && histChoice === "historical" ? (
                  <div className="documents-wizard-inline-notice">
                    El documento quedó guardado solo como parte de tu historial.
                  </div>
                ) : null}

                <div className="documents-wizard-section">
                  <div className="documents-wizard-section-head">
                    <strong>Solo necesito que confirmes esto</strong>
                    <span>Si el tipo no coincide, corrígelo aquí mismo.</span>
                  </div>
                  {!editingType ? (
                    <>
                      <p className="documents-wizard-helper">
                        {isCoverageUpload
                          ? "Klinip lo guardó como Cobertura / seguro. Si además corresponde a receta, orden, resultado o informe, puedes cambiar el tipo clínico."
                          : requiresReview
                          ? `Klinip cree que es ${typeCopy.article}, pero encontró partes que conviene revisar antes de darlo por cerrado.`
                          : `Klinip lo clasificó como ${typeCopy.article}. Si te hace sentido, puedes guardarlo así.`}
                      </p>
                      <div className="documents-wizard-button-stack">
                        <button type="button" className="primary-btn" onClick={handleConfirmResult}>
                          Guardar así
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setEditingType(true)}
                        >
                          Cambiar tipo
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="documents-wizard-type-grid">
                      {TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`documents-wizard-type-btn${
                            option.value === analysisType ? " is-active" : ""
                          }`}
                          disabled={savingType}
                          onClick={() => handleChangeType(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {step === "error" ? (
              <div className="documents-wizard-body">
                <div className="documents-wizard-hero is-centered">
                  <span className="documents-wizard-kicker">Estado del documento</span>
                  <h2>Tu documento está a salvo</h2>
                  <p>{errorMsg}</p>
                </div>
                <div className="documents-wizard-button-stack">
                  <button type="button" className="primary-btn" onClick={onClose}>
                    Entendido
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setStep("choose")}
                  >
                    Subir otro documento
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>,
        document.getElementById("overlay-root") || document.body,
      )}

      <SuccessSheet
        open={doneOpen}
        onClose={() => {
          setDoneOpen(false);
          onClose?.();
        }}
        kicker="Documento guardado"
        title="Todo listo"
        copy={buildSuccessCopy(displayType, histChoice)}
        referenceId={docId}
        rows={[
          {
            icon: "doc",
            label: "Tipo de documento",
            value: isCoverageUpload ? "Cobertura / seguro" : getFriendlyTypeLabel(analysisType),
          },
          { icon: "building", label: "Centro", value: centerVal || "Sin centro registrado" },
          { icon: "clock", label: "Fecha", value: dateVal || "Sin fecha" },
        ]}
        secondaryLabel="Volver a documentos"
      />
    </>
  );
}
