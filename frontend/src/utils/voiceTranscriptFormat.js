function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sectionTone(normalizedTitle) {
  if (
    normalizedTitle.includes("motivo referido") ||
    normalizedTitle.includes("antecedente referido") ||
    normalizedTitle.includes("relato del paciente") ||
    normalizedTitle.includes("motivo de consulta") ||
    normalizedTitle.includes("anamnesis") ||
    normalizedTitle.includes("antecedentes")
  ) {
    return { key: "patient", label: "Paciente/usuario" };
  }

  if (
    normalizedTitle.includes("hallazgo observado") ||
    (normalizedTitle.includes("hallazgos") &&
      !normalizedTitle.includes("impresion")) ||
    normalizedTitle.includes("examen fisico") ||
    normalizedTitle.includes("signos") ||
    normalizedTitle.includes("observacion objetiva")
  ) {
    return { key: "observed", label: "Hallazgo observado" };
  }

  if (
    normalizedTitle.includes("evaluacion") ||
    normalizedTitle.includes("intervencion") ||
    normalizedTitle.includes("impresion") ||
    normalizedTitle.includes("hallazgos e impresion") ||
    normalizedTitle.includes("plan de manejo") ||
    normalizedTitle.includes("plan terapeutico") ||
    normalizedTitle.includes("proximos pasos") ||
    normalizedTitle.includes("indicaciones del profesional")
  ) {
    return { key: "professional", label: "Profesional" };
  }

  return { key: "neutral", label: "Resumen técnico" };
}

function relabelSectionTitle(title, metadata) {
  const normalizedTitle = normalizeText(title);
  const canDiagnose = metadata?.puede_diagnosticar_medicamente !== false;

  if (normalizedTitle.includes("tipo de consulta")) {
    return canDiagnose ? "Tipo de consulta" : "Tipo de atención";
  }

  if (
    normalizedTitle === "anamnesis" ||
    normalizedTitle.includes("antecedentes") ||
    normalizedTitle.includes("historia relatada")
  ) {
    return "Antecedente referido por el paciente/usuario";
  }

  if (normalizedTitle.includes("motivo de consulta")) {
    return "Motivo referido por el paciente/usuario";
  }

  if (
    normalizedTitle.includes("examen fisico") ||
    (normalizedTitle.includes("hallazgos") &&
      !normalizedTitle.includes("impresion")) ||
    normalizedTitle.includes("signos") ||
    normalizedTitle.includes("hallazgos objetivos")
  ) {
    return "Hallazgo observado";
  }

  if (normalizedTitle === "evaluacion") {
    return "Evaluación del profesional";
  }

  if (!canDiagnose && normalizedTitle.includes("diagnostico")) {
    return "Evaluación e impresión del profesional";
  }

  if (canDiagnose && normalizedTitle.includes("diagnostico")) {
    return "Diagnóstico o impresión registrada";
  }

  if (!canDiagnose && normalizedTitle.includes("impresion")) {
    return "Evaluación e impresión del profesional";
  }

  if (normalizedTitle.includes("indicaciones")) {
    return "Indicaciones del profesional";
  }

  return title;
}

function splitBulletLines(body) {
  return String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getVoiceProfessionalMeta(metadata = {}) {
  const role =
    metadata?.profesional_confirmado ||
    metadata?.especialidad_inferida ||
    "Profesional de salud";
  const nonDiagnosticRole = metadata?.puede_diagnosticar_medicamente === false;

  return {
    role,
    nonDiagnosticRole,
    disclaimer: nonDiagnosticRole
      ? "Esta atención no implica diagnóstico médico. Klinip separa lo referido por el paciente/usuario de lo observado o indicado por el profesional."
      : "Klinip resume la atención respetando lo referido por el paciente/usuario y lo registrado por el profesional.",
  };
}

export function parseVoiceTechnicalSections(technicalText, metadata = {}) {
  const source = String(technicalText || "").replace(/\r/g, "").trim();
  if (!source) return [];

  const chunks = source
    .split(/\n(?=##\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (!chunks.some((chunk) => chunk.startsWith("## "))) {
    return [
      {
        id: "tecnica-0",
        title: "Resumen técnico",
        tone: { key: "neutral", label: "Resumen técnico" },
        lines: splitBulletLines(source),
      },
    ];
  }

  return chunks.map((chunk, index) => {
    const lines = chunk.split("\n");
    const rawTitle =
      lines.shift()?.replace(/^##\s+/, "").trim() || `Sección ${index + 1}`;
    const title = relabelSectionTitle(rawTitle, metadata);
    const normalizedTitle = normalizeText(title);

    return {
      id: `tecnica-${index}`,
      title,
      tone: sectionTone(normalizedTitle),
      lines: splitBulletLines(lines.join("\n")),
    };
  });
}
