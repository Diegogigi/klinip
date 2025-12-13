import { generateId, listDocuments } from "./storage";

const KEY = "klinip_medications";

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Error leyendo meds", err);
    return [];
  }
};

const write = (items) => localStorage.setItem(KEY, JSON.stringify(items));

export function listMeds() {
  return read();
}

export function saveMed(med) {
  const meds = read();
  const id = med.id || generateId(meds);
  const now = new Date().toISOString();
  const updated = { ...med, id, created_at: med.created_at || now };
  const idx = meds.findIndex((m) => m.id === id);
  if (idx >= 0) meds[idx] = updated;
  else meds.push(updated);
  write(meds);
  return updated;
}

export function deleteMed(id) {
  const meds = read().filter((m) => m.id !== id);
  write(meds);
  return { ok: true };
}

export function getDocumentOptions() {
  const docs = listDocuments();
  return docs.map((d) => ({
    id: d.id,
    label: `${d.doc_type} - ${d.center || "Sin centro"}`,
  }));
}
