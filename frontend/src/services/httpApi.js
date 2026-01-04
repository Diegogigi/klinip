import axios from "axios";

// Usar variable de entorno en producción, o localhost en desarrollo
const API_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.PROD ? "" : "http://localhost:8000");

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    console.log("Request interceptor: Token agregado al header", token.substring(0, 20) + "...");
  } else {
    console.warn("Request interceptor: No hay token en localStorage");
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error("401 Unauthorized - Token inválido o expirado");
      console.error("Response data:", error.response?.data);
      // Limpiar token inválido
      localStorage.removeItem("token");
    }
    return Promise.reject(error);
  }
);

export async function register({ name, email, password }) {
  const res = await api.post("/auth/register", { name, email, password });
  return res.data;
}

export async function login({ email, password }) {
  const params = new URLSearchParams();
  params.append("username", email);
  params.append("password", password);
  const res = await api.post("/auth/login", params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data;
}

export async function logout() {
  return true;
}

export async function getMe() {
  const res = await api.get("/me");
  return res.data;
}

export async function updateMe(payload) {
  const res = await api.put("/me", payload);
  return res.data;
}

// Privacy
export async function revokeDataConsent() {
  const res = await api.post("/privacy/revoke-consent");
  return res.data;
}

export async function deleteAccount() {
  const res = await api.post("/privacy/delete-account");
  return res.data;
}

export async function submitPrivacyRequest(payload) {
  const res = await api.post("/privacy/contact", payload);
  return res.data;
}

export async function getAppointments() {
  const res = await api.get("/appointments");
  return res.data;
}

export async function createAppointment(payload) {
  const res = await api.post("/appointments", payload);
  return res.data;
}

export async function updateAppointment(id, payload) {
  const res = await api.put(`/appointments/${id}`, payload);
  return res.data;
}

export async function deleteAppointment(id) {
  const res = await api.delete(`/appointments/${id}`);
  return res.data;
}

export async function getDocuments() {
  const res = await api.get("/documents");
  return res.data;
}

export async function uploadDocument(payload) {
  const formData = payload instanceof FormData ? payload : new FormData();
  if (!(payload instanceof FormData)) {
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      formData.append(key, value);
    });
  }
  const res = await api.post("/documents", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function deleteDocument(id) {
  const res = await api.delete(`/documents/${id}`);
  return res.data;
}

export async function updateDocument(id, payload) {
  const res = await api.put(`/documents/${id}`, payload);
  return res.data;
}

export async function getDocumentFile(documentId) {
  const token = localStorage.getItem("token");
  const API_URL = import.meta.env.VITE_API_URL || 
    (import.meta.env.PROD ? "" : "http://localhost:8000");
  
  const response = await api.get(`/documents/${documentId}/file`, {
    responseType: "blob",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  // Crear una URL temporal para el blob
  const blob = new Blob([response.data], { type: response.headers["content-type"] });
  const url = window.URL.createObjectURL(blob);
  return url;
}

// Medications
export async function getMedications() {
  const res = await api.get("/medications");
  return res.data;
}

export async function saveMedication(payload) {
  if (payload.id) {
    const res = await api.put(`/medications/${payload.id}`, payload);
    return res.data;
  }
  const res = await api.post("/medications", payload);
  return res.data;
}

export async function deleteMedication(id) {
  const res = await api.delete(`/medications/${id}`);
  return res.data;
}

export async function recordMedicationIntake(id) {
  const res = await api.post(`/medications/${id}/intake`);
  return res.data;
}

// Push subscriptions
export async function subscribePush(payload) {
  const res = await api.post("/push/subscribe", payload);
  return res.data;
}

export async function unsubscribePush(payload) {
  const res = await api.delete("/push/unsubscribe", { data: payload });
  return res.data;
}

export async function getPushStatus() {
  const res = await api.get("/push/status");
  return res.data;
}

export async function sendTestPush() {
  const res = await api.post("/push/test");
  return res.data;
}

// Public stats
export async function getLandingStats() {
  const res = await api.get("/public/stats");
  return res.data;
}
