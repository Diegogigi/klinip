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

export async function forgotPassword(payload) {
  const res = await api.post("/auth/forgot-password", payload);
  return res.data;
}

export async function resetPassword(payload) {
  const res = await api.post("/auth/reset-password", payload);
  return res.data;
}

export async function getMe() {
  const res = await api.get("/me");
  return res.data;
}

export async function updateMe(payload) {
  const res = await api.put("/me", payload);
  return res.data;
}

export async function getMyPlan() {
  const res = await api.get("/plans/me");
  return res.data;
}

export async function getPublicPlans() {
  const res = await api.get("/public/plans");
  return Array.isArray(res.data)
    ? res.data.map((plan) => ({
        slug: plan.slug,
        name: plan.name,
        priceMonthly: plan.price_monthly,
        priceYearly: plan.price_yearly,
        yearlyEquivalent: plan.yearly_equivalent,
        note: plan.note,
        summary: plan.summary,
        recommended: !!plan.recommended,
        cta: plan.cta,
        features: Array.isArray(plan.features) ? plan.features : [],
        detailSections: Array.isArray(plan.detail_sections)
          ? plan.detail_sections.map((section) => ({
              title: section.title,
              items: Array.isArray(section.items) ? section.items : [],
            }))
          : [],
        metrics: Array.isArray(plan.metrics)
          ? plan.metrics.map((metric) => ({
              label: metric.label,
              value: metric.value,
            }))
          : [],
      }))
    : [];
}

export async function getHealthProfiles() {
  const res = await api.get("/health-profiles");
  return res.data;
}

export async function getActiveHealthProfile() {
  const res = await api.get("/health-profiles/active");
  return res.data;
}

export async function createHealthProfile(payload) {
  const res = await api.post("/health-profiles", payload);
  return res.data;
}

export async function updateHealthProfile(id, payload) {
  const res = await api.put(`/health-profiles/${id}`, payload);
  return res.data;
}

export async function setActiveHealthProfile(id) {
  const res = await api.post(`/health-profiles/${id}/set-active`);
  return res.data;
}

export async function getFamilyPanel() {
  const res = await api.get("/family/panel");
  return res.data;
}

export async function getProfileCaregivers(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/caregivers`);
  return res.data;
}

export async function inviteProfileCaregiver(profileId, payload) {
  const res = await api.post(`/health-profiles/${profileId}/invitations`, payload);
  return res.data;
}

export async function getProfileInvitations(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/invitations`);
  return res.data;
}

export async function getMyPendingProfileInvitations() {
  const res = await api.get("/health-profiles/invitations/my-pending");
  return res.data;
}

export async function acceptProfileInvitation(token) {
  const res = await api.post("/health-profiles/invitations/accept", { token });
  return res.data;
}

export async function updateProfileRelationship(profileId, relationshipId, payload) {
  const res = await api.put(`/health-profiles/${profileId}/relationships/${relationshipId}`, payload);
  return res.data;
}

export async function removeProfileRelationship(profileId, relationshipId) {
  const res = await api.delete(`/health-profiles/${profileId}/relationships/${relationshipId}`);
  return res.data;
}

export async function revokeProfileInvitation(profileId, invitationId) {
  const res = await api.delete(`/health-profiles/${profileId}/invitations/${invitationId}`);
  return res.data;
}

export async function getHealthProfileActivity(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/activity`);
  return res.data;
}

export async function getFamilyAlerts() {
  const res = await api.get("/family/alerts");
  return res.data;
}

export async function getFamilyReportSummary(days = 30) {
  const res = await api.get("/family/reports/summary", { params: { days } });
  return res.data;
}

export async function runFamilyAutomations(sendEmail = false) {
  const res = await api.post("/family/automations/run", null, {
    params: { send_email: !!sendEmail },
  });
  return res.data;
}

export async function getProfileAutomation(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/automation`);
  return res.data;
}

export async function updateProfileAutomation(profileId, payload) {
  const res = await api.put(`/health-profiles/${profileId}/automation`, payload);
  return res.data;
}

export async function getProfileNotes(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/notes`);
  return res.data;
}

export async function createProfileNote(profileId, payload) {
  const res = await api.post(`/health-profiles/${profileId}/notes`, payload);
  return res.data;
}

export async function sendAiChat(payload) {
  const res = await api.post("/ai/chat", payload);
  return res.data;
}

export async function getAiConversations() {
  const res = await api.get("/ai/conversations");
  return res.data;
}

export async function getAiHistory(conversationId) {
  const res = await api.get("/ai/history", {
    params: conversationId ? { conversation_id: conversationId } : undefined,
  });
  return res.data;
}

export async function deleteAiConversation(conversationId) {
  const res = await api.delete(`/ai/conversations/${conversationId}`);
  return res.data;
}

export async function clearAiHistory() {
  const res = await api.delete("/ai/history");
  return res.data;
}

export async function getAiHealthRadar(profileId) {
  const res = await api.get("/ai/health-radar", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function runAiHealthRadar(profileId) {
  const res = await api.post("/ai/health-radar/run", null, {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function getAiAdherence(profileId) {
  const res = await api.get("/ai/adherence", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return res.data || {};
}

export async function getAiDocumentIntelligence(profileId) {
  const res = await api.get("/ai/documents/intelligence", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function generateAiClinicalReport(payload, profileId) {
  const res = await api.post("/ai/reports/generate", payload, {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return res.data;
}

export async function getAiClinicalReports(profileId) {
  const res = await api.get("/ai/reports", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function getAiClinicalReport(reportId) {
  const res = await api.get(`/ai/reports/${reportId}`);
  return res.data;
}

export async function getAiClinicalReportPdf(reportId) {
  const res = await api.get(`/ai/reports/${reportId}/pdf`, {
    responseType: "blob",
  });
  return res.data;
}

export async function getAiFamilyContext(days = 30) {
  const res = await api.get("/ai/family/context", { params: { days } });
  return res.data || {};
}

export async function getAiLifeTimeline(params = {}) {
  const res = await api.get("/ai/life-timeline", { params });
  return res.data || {};
}

export async function getInteroperabilitySources(profileId) {
  const res = await api.get("/ai/interoperability/sources", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function createInteroperabilitySource(payload, profileId) {
  const res = await api.post("/ai/interoperability/sources", payload, {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return res.data;
}

export async function getInteroperabilityRecords(profileId) {
  const res = await api.get("/ai/interoperability/records", {
    params: profileId ? { profile_id: profileId } : undefined,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function createInteroperabilityRecord(payload, profileId) {
  const res = await api.post("/ai/interoperability/records", payload, {
    params: profileId ? { profile_id: profileId } : undefined,
  });
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

export async function recordMedicationIntake(id, payload) {
  const res = await api.post(`/medications/${id}/intake`, payload || {});
  return res.data;
}

export async function getMedicationIntakes(id, limit = 40) {
  const res = await api.get(`/medications/${id}/intakes`, { params: { limit } });
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
