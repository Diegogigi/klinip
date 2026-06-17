const VOICE_RECORDER_MIME_OPTIONS = [
  { mimeType: "audio/mp4", extension: "m4a" },
  { mimeType: "audio/x-m4a", extension: "m4a" },
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/webm", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/ogg", extension: "ogg" },
];

const VOICE_EXTENSION_BY_MIME = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function getPreferredVoiceRecorderOption() {
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "", extension: "webm" };
  }
  const supported = VOICE_RECORDER_MIME_OPTIONS.find(({ mimeType }) => (
    typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(mimeType)
  ));
  return supported || { mimeType: "", extension: "webm" };
}

export function resolveVoiceMimeInfo(source, fallbackExtension = "webm") {
  const rawMime = typeof source === "string" ? source : source?.type || "";
  const normalizedMime = rawMime.split(";")[0].trim().toLowerCase();
  if (normalizedMime && VOICE_EXTENSION_BY_MIME[normalizedMime]) {
    return {
      mimeType: normalizedMime,
      extension: VOICE_EXTENSION_BY_MIME[normalizedMime],
    };
  }
  if (fallbackExtension === "ogg") {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  if (fallbackExtension === "m4a") {
    return { mimeType: "audio/mp4", extension: "m4a" };
  }
  if (fallbackExtension === "mp3") {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }
  if (fallbackExtension === "wav") {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (fallbackExtension === "aac") {
    return { mimeType: "audio/aac", extension: "aac" };
  }
  return { mimeType: "audio/webm", extension: "webm" };
}

export function buildRecordedVoiceBlob(chunks, sourceMime, fallbackExtension = "webm") {
  const mimeInfo = resolveVoiceMimeInfo(sourceMime, fallbackExtension);
  return new Blob(chunks || [], { type: mimeInfo.mimeType });
}

export function buildVoiceUploadName(baseName, blob, fallbackExtension = "webm") {
  const mimeInfo = resolveVoiceMimeInfo(blob?.type || "", fallbackExtension);
  return `${baseName}.${mimeInfo.extension}`;
}
