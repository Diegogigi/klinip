import {
  clearSession,
  generateId,
  getSession,
  listAppointments,
  listDocuments,
  listUsers,
  sanitizeUser,
  saveAppointments,
  saveDocuments,
  saveUsers,
  setSession,
} from "./storage";

const ensureSession = () => {
  const session = getSession();
  if (!session) {
    throw new Error("No hay sesiÃ³n activa");
  }
  return session;
};

export function register({ name, email, password }) {
  const users = listUsers();
  const exists = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    const err = new Error("El correo ya estÃ¡ registrado");
    err.code = "USER_EXISTS";
    throw err;
  }
  const now = new Date().toISOString();
  const user = {
    id: generateId(users),
    name,
    email,
    password,
    created_at: now,
  };
  users.push(user);
  saveUsers(users);
  return sanitizeUser(user);
}

export function login({ email, password }) {
  const users = listUsers();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) {
    const err = new Error("Correo o contraseÃ±a incorrectos");
    err.code = "INVALID_CREDENTIALS";
    throw err;
  }
  const session = {
    token: `demo_${Math.random().toString(36).slice(2, 10)}`,
    user_id: user.id,
    created_at: new Date().toISOString(),
  };
  setSession(session);
  return { access_token: session.token, token_type: "demo", user: sanitizeUser(user) };
}

export function logout() {
  clearSession();
}

export function getMe() {
  const session = ensureSession();
  const users = listUsers();
  const user = users.find((u) => u.id === session.user_id);
  if (!user) {
    clearSession();
    throw new Error("SesiÃ³n no vÃ¡lida");
  }
  return sanitizeUser(user);
}

// Appointments
export function getAppointments() {
  const session = ensureSession();
  const all = listAppointments();
  return all.filter((a) => a.user_id === session.user_id);
}

export function createAppointment(payload) {
  const session = ensureSession();
  const all = listAppointments();
  const now = new Date().toISOString();
  const appt = {
    id: generateId(all),
    user_id: session.user_id,
    type: payload.type,
    specialty: payload.specialty || "",
    center: payload.center || "",
    date_time: payload.date_time || null,
    status: payload.status || "pendiente",
    notes: payload.notes || "",
    created_at: now,
  };
  all.push(appt);
  saveAppointments(all);
  return appt;
}

export function updateAppointment(id, payload) {
  const session = ensureSession();
  const all = listAppointments();
  const idx = all.findIndex((a) => a.id === id && a.user_id === session.user_id);
  if (idx === -1) {
    throw new Error("Cita no encontrada");
  }
  const updated = { ...all[idx], ...payload };
  all[idx] = updated;
  saveAppointments(all);
  return updated;
}

export function deleteAppointment(id) {
  const session = ensureSession();
  const all = listAppointments();
  const remaining = all.filter((a) => !(a.id === id && a.user_id === session.user_id));
  saveAppointments(remaining);
  return { ok: true };
}

// Documents
const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export async function getDocuments() {
  const session = ensureSession();
  const all = listDocuments();
  return all.filter((d) => d.user_id === session.user_id);
}

export async function uploadDocument(payload) {
  const session = ensureSession();
  const all = listDocuments();
  const now = new Date().toISOString();

  const dataUrl = payload.file ? await fileToDataUrl(payload.file) : null;

  const doc = {
    id: generateId(all),
    user_id: session.user_id,
    doc_type: payload.doc_type,
    appointment_id: payload.appointment_id || null,
    date: payload.date || now,
    center: payload.center || "",
    notes: payload.notes || "",
    filename: payload.file?.name || "archivo",
    mime: payload.file?.type || "application/octet-stream",
    data_url: dataUrl,
    created_at: now,
  };

  all.push(doc);
  saveDocuments(all);
  return doc;
}

export function deleteDocument(id) {
  const session = ensureSession();
  const all = listDocuments();
  const remaining = all.filter((d) => !(d.id === id && d.user_id === session.user_id));
  saveDocuments(remaining);
  return { ok: true };
}
