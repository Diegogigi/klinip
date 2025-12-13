const KEYS = {
  users: "klinip_users",
  session: "klinip_session",
  appointments: "klinip_appointments",
  documents: "klinip_documents",
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error("Error leyendo storage", err);
    return fallback;
  }
};

const write = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const nextId = (items) =>
  items.length ? Math.max(...items.map((i) => i.id || 0)) + 1 : 1;

// Usuarios
export const listUsers = () => read(KEYS.users, []);
export const saveUsers = (users) => write(KEYS.users, users);

// Sesion
export const getSession = () => read(KEYS.session, null);
export const setSession = (session) => write(KEYS.session, session);
export const clearSession = () => localStorage.removeItem(KEYS.session);

// Citas
export const listAppointments = () => read(KEYS.appointments, []);
export const saveAppointments = (items) => write(KEYS.appointments, items);

// Documentos
export const listDocuments = () => read(KEYS.documents, []);
export const saveDocuments = (items) => write(KEYS.documents, items);

// Helpers
export const generateId = (collection) => nextId(collection);

export const sanitizeUser = (user) =>
  user
    ? {
        id: user.id,
        name: user.name,
        email: user.email,
        created_at: user.created_at,
      }
    : null;
