import axios from "axios";
import { buildVoiceUploadName } from "../utils/voiceRecording";

// Usar variable de entorno en producción, o localhost en desarrollo
const API_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.PROD ? "" : "http://localhost:8000");

const api = axios.create({
  baseURL: API_URL,
});

// Instancia separada para el refresh (no pasa por el interceptor de 401)
const refreshApi = axios.create({ baseURL: API_URL });

const AUTH_EXEMPT_PATH_PREFIXES = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/mfa/verify",
  "/auth/token/refresh",
  "/public/",
  "/privacy/contact",
];

let _refreshPromise = null;
let _sessionExpiredNotified = false;

function _clearStoredSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refresh_token");
}

function _notifySessionExpired() {
  if (_sessionExpiredNotified) return;
  _sessionExpiredNotified = true;
  window.dispatchEvent(new CustomEvent("klinip:session-expired"));
}

function _resetSessionExpiredSignal() {
  _sessionExpiredNotified = false;
}

function _getRequestPath(config) {
  const rawUrl = String(config?.url || "").trim();
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      return new URL(rawUrl).pathname.toLowerCase();
    } catch {
      return rawUrl.toLowerCase();
    }
  }
  return rawUrl.split("?")[0].toLowerCase();
}

function _isAuthExemptRequest(config) {
  const path = _getRequestPath(config);
  return AUTH_EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function _decodeJwtPayload(token) {
  try {
    const base64Url = String(token || "").split(".")[1] || "";
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function _isTokenFresh(token, marginMs = 30_000) {
  if (!token) return false;
  const payload = _decodeJwtPayload(token);
  const expiresAt = Number(payload?.exp || 0) * 1000;
  if (!expiresAt) return false;
  return Date.now() < expiresAt - marginMs;
}

function _buildAuthError(message, config, status = 401) {
  const error = new Error(message);
  error.name = "KlinipAuthError";
  error.code = "ERR_AUTH_SESSION";
  error.isAuthError = true;
  error.config = config;
  error.response = {
    status,
    data: { detail: message },
    headers: {},
  };
  return error;
}

export function isAuthSessionError(error) {
  return Boolean(
    error?.isAuthError ||
    error?.code === "ERR_AUTH_SESSION" ||
    error?.response?.status === 401
  );
}

async function _normalizeErrorResponse(error) {
  const response = error?.response;
  if (!response) return error;

  let detail = response.data?.detail;

  if (
    detail === undefined &&
    typeof Blob !== "undefined" &&
    response.data instanceof Blob
  ) {
    const contentType = String(
      response.headers?.["content-type"] || response.data.type || ""
    ).toLowerCase();

    if (contentType.includes("json") || contentType.includes("text")) {
      try {
        const text = await response.data.text();
        const parsed = JSON.parse(text);
        response.data = parsed;
        detail = parsed?.detail;
      } catch {
        // Mantener el error original si el blob no trae JSON valido.
      }
    }
  }

  if (response.status === 403) {
    if (detail?.code === "step_up_required" || detail === "step_up_required") {
      error.stepUpRequired = true;
    }
  }

  return error;
}

async function _refreshAccessTokenWithLock() {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    _clearStoredSession();
    _notifySessionExpired();
    throw _buildAuthError("La sesión expiró. Inicia sesión nuevamente.");
  }

  if (_refreshPromise) {
    return _refreshPromise;
  }

  _refreshPromise = (async () => {
    try {
      const res = await refreshApi.post("/auth/token/refresh", {
        refresh_token: refreshToken,
      });
      const newAccessToken = res.data?.access_token;
      if (!newAccessToken) {
        throw new Error("No access_token en respuesta");
      }

      localStorage.setItem("token", newAccessToken);
      if (res.data?.refresh_token) {
        localStorage.setItem("refresh_token", res.data.refresh_token);
      }
      _resetSessionExpiredSignal();
      return newAccessToken;
    } catch (error) {
      const normalizedError = await _normalizeErrorResponse(error);
      _clearStoredSession();
      _notifySessionExpired();
      throw normalizedError;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

api.interceptors.request.use(async (config) => {
  if (_isAuthExemptRequest(config)) {
    return config;
  }

  const token = localStorage.getItem("token");
  if (_isTokenFresh(token)) {
    _resetSessionExpiredSignal();
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  }

  const refreshToken = localStorage.getItem("refresh_token");
  if (refreshToken) {
    const newAccessToken = await _refreshAccessTokenWithLock();
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${newAccessToken}`;
    return config;
  }

  _clearStoredSession();
  _notifySessionExpired();
  throw _buildAuthError("La sesión expiró. Inicia sesión nuevamente.", config);
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const normalizedError = await _normalizeErrorResponse(error);
    const originalRequest = normalizedError.config || {};

    // 403 con step_up_required: propagar con bandera especial
    if (normalizedError.response?.status === 403) {
      return Promise.reject(normalizedError);
    }

    const isFormDataRequest = originalRequest.data instanceof FormData;
    if (
      normalizedError.response?.status === 401 &&
      !_isAuthExemptRequest(originalRequest) &&
      !originalRequest._retry &&
      !isFormDataRequest
    ) {
      originalRequest._retry = true;

      try {
        const newAccessToken = await _refreshAccessTokenWithLock();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    if (normalizedError.response?.status === 401 && !_isAuthExemptRequest(originalRequest)) {
      _clearStoredSession();
      _notifySessionExpired();
    }

    // 401: intentar renovar el access token con el refresh token
    // No reintentar requests con FormData (blobs se consumen en el primer intento)
    const hasFormData = originalRequest.data instanceof FormData;
    if (false && normalizedError.response?.status === 401 && !originalRequest._retry && !hasFormData) {
      const refreshToken = localStorage.getItem("refresh_token");

      // Sin refresh token → cerrar sesión
      if (!refreshToken) {
        localStorage.removeItem("token");
        localStorage.removeItem("refresh_token");
        window.dispatchEvent(new CustomEvent("klinip:session-expired"));
        return Promise.reject(normalizedError);
      }

      // Si ya hay un refresh en curso, encolar esta petición
      if (_isRefreshing) {
        return new Promise((resolve, reject) => {
          _refreshQueue.push({ resolve, reject });
        })
          .then((newToken) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      _isRefreshing = true;

      try {
        const res = await refreshApi.post("/auth/token/refresh", {
          refresh_token: refreshToken,
        });
        const newAccessToken = res.data?.access_token;
        if (!newAccessToken) throw new Error("No access_token en respuesta");

        localStorage.setItem("token", newAccessToken);
        if (res.data?.refresh_token) {
          localStorage.setItem("refresh_token", res.data.refresh_token);
        }

        _processRefreshQueue(null, newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        _processRefreshQueue(refreshError, null);
        localStorage.removeItem("token");
        localStorage.removeItem("refresh_token");
        window.dispatchEvent(new CustomEvent("klinip:session-expired"));
        return Promise.reject(refreshError);
      } finally {
        _isRefreshing = false;
      }
    }

    return Promise.reject(normalizedError);
  }
);

/**
 * Ensure token is fresh before sending requests with FormData (blobs).
 * Blobs cannot survive a 401-retry cycle because they are consumed on first send.
 */
async function _ensureFreshToken() {
  const token = localStorage.getItem("token");
  if (!token) return;
  if (_isTokenFresh(token)) return;
  try {
    // Decode JWT payload to check expiry (without verifying signature)
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresAt = (payload.exp || 0) * 1000;
    const margin = 30_000; // 30s margin
    if (Date.now() < expiresAt - margin) return; // token still valid
  } catch {
    // If decoding fails, try refreshing anyway
  }
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) return;
  try {
    await _refreshAccessTokenWithLock();
  } catch {
    // If refresh fails here, the actual request will fail with 401 and
    // the interceptor will handle session expiry.
  }
}

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

export async function updateProfileNote(profileId, noteId, payload) {
  const res = await api.put(`/health-profiles/${profileId}/notes/${noteId}`, payload);
  return res.data;
}

export async function deleteProfileNote(profileId, noteId) {
  const res = await api.delete(`/health-profiles/${profileId}/notes/${noteId}`);
  return res.data;
}

export async function sendAiChat(payload) {
  const res = await api.post("/ai/chat", payload, {
    timeout: 90000,
  });
  return res.data;
}

export async function transcribeAiChatAudio(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/ai/chat/transcribe", formData, {
    timeout: 90000,
  });
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

export async function renameAiConversation(conversationId, payload) {
  const res = await api.patch(`/ai/conversations/${conversationId}`, payload);
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

export async function deleteAccount(stepUpToken) {
  const res = await api.post("/privacy/delete-account", undefined, {
    headers: stepUpToken ? { "X-StepUp-Token": stepUpToken } : {},
  });
  return res.data;
}

export async function submitPrivacyRequest(payload) {
  const res = await api.post("/privacy/contact", payload);
  return res.data;
}

export async function getAppointments(options = {}) {
  const params = {};
  if (options.profileId) params.profile_id = options.profileId;
  const res = await api.get("/appointments", { params });
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
  const response = await api.get(`/documents/${documentId}/file`, {
    responseType: "blob",
  });

  return response.data;
}

// Medications
export async function getMedications(options = {}) {
  const params = {};
  if (options.profileId) params.profile_id = options.profileId;
  const res = await api.get("/medications", { params });
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

export async function markMedicationRefillPurchased(id, newStockTotalDoses) {
  const res = await api.post(`/medications/${id}/mark-purchased`, {
    new_stock_total_doses: newStockTotalDoses || 0,
  });
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

// ─── Step-up authentication ────────────────────────────────────────────────────

export async function stepUpVerify(payload) {
  const res = await api.post("/auth/stepup/verify", payload);
  return res.data;
}

export async function requestStepUpEmailCode() {
  const res = await api.post("/auth/stepup/email/request");
  return res.data;
}

/**
 * Realiza una petición GET con el step-up token en el header X-StepUp-Token.
 * Usado para descargar documentos clínicos protegidos.
 */
export async function getDocumentFileWithStepUp(documentId, stepUpToken) {
  const res = await api.get(`/documents/${documentId}/file`, {
    responseType: "blob",
    headers: stepUpToken ? { "X-StepUp-Token": stepUpToken } : {},
  });
  return res.data;
}

// ─── MFA ─────────────────────────────────────────────────────────────────────

export async function verifyMfaLogin(payload) {
  const res = await api.post("/auth/mfa/verify", payload);
  return res.data;
}

export async function getMfaStatus() {
  const res = await api.get("/auth/mfa/status");
  return res.data;
}

export async function startMfaEnroll() {
  const res = await api.post("/auth/mfa/enroll");
  return res.data;
}

export async function verifyMfaEnrollment(payload) {
  const res = await api.post("/auth/mfa/verify-enrollment", payload);
  return res.data;
}

export async function disableMfa(payload) {
  const res = await api.post("/auth/mfa/disable", payload);
  return res.data;
}

export async function regenerateMfaBackupCodes(payload) {
  const res = await api.post("/auth/mfa/backup-codes/regenerate", payload);
  return res.data;
}

// ─── Refresh token + sesiones ─────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken) {
  const res = await api.post("/auth/token/refresh", { refresh_token: refreshToken });
  return res.data;
}

export async function getSessions() {
  const res = await api.get("/auth/sessions");
  return res.data;
}

export async function revokeSession(sessionId) {
  const res = await api.delete(`/auth/sessions/${sessionId}`);
  return res.data;
}

export async function revokeAllSessions() {
  const res = await api.delete("/auth/sessions");
  return res.data;
}

// ─── Permisos granulares ──────────────────────────────────────────────────────

export async function getProfilePermissions(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/permissions`);
  return res.data;
}

export async function updateRelationshipPermissions(profileId, relationshipId, permissions) {
  const res = await api.put(
    `/health-profiles/${profileId}/relationships/${relationshipId}/permissions`,
    { permissions }
  );
  return res.data;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function getAuditLogs({ limit = 50, offset = 0 } = {}) {
  const res = await api.get("/audit/logs", { params: { limit, offset } });
  return res.data;
}

// ─── KlinipFeed ───────────────────────────────────────────────────────────────

export async function getFamilyFeed({ skip = 0, limit = 20 } = {}) {
  const res = await api.get("/feed/family", { params: { skip, limit } });
  return Array.isArray(res.data) ? res.data : [];
}

export async function createFeedPost(payload) {
  const res = await api.post("/feed/posts", payload);
  return res.data;
}

export async function updateFeedPost(postId, payload) {
  const res = await api.put(`/feed/posts/${postId}`, payload);
  return res.data;
}

export async function deleteFeedPost(postId) {
  await api.delete(`/feed/posts/${postId}`);
}

export async function reactToPost(postId, reactionType = "like") {
  const res = await api.post(`/feed/posts/${postId}/reactions`, { reaction_type: reactionType });
  return res.data;
}

export async function removeReaction(postId) {
  await api.delete(`/feed/posts/${postId}/reactions`);
}

export async function getPostComments(postId) {
  const res = await api.get(`/feed/posts/${postId}/comments`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function addPostComment(postId, payload) {
  const body =
    typeof payload === "string"
      ? { content: payload }
      : {
          content: payload?.content || "",
          parent_comment_id: payload?.parent_comment_id ?? null,
          mention_user_ids: Array.isArray(payload?.mention_user_ids) ? payload.mention_user_ids : [],
        };
  const res = await api.post(`/feed/posts/${postId}/comments`, body);
  return res.data;
}

export async function deletePostComment(postId, commentId) {
  await api.delete(`/feed/posts/${postId}/comments/${commentId}`);
}

export async function likePostComment(postId, commentId) {
  const res = await api.post(`/feed/posts/${postId}/comments/${commentId}/like`);
  return res.data;
}

export async function unlikePostComment(postId, commentId) {
  await api.delete(`/feed/posts/${postId}/comments/${commentId}/like`);
}

export async function uploadPostAttachment(postId, file, attachmentType = "image") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("attachment_type", attachmentType);
  const res = await api.post(`/feed/posts/${postId}/attachments`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function uploadHealthProfileAvatar(profileId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post(`/health-profiles/${profileId}/avatar`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export function getPostAttachmentUrl(postId, attachmentId) {
  const base = api.defaults.baseURL || "";
  const token = localStorage.getItem("token");
  return `${base}/feed/posts/${postId}/attachments/${attachmentId}/file?token=${token}`;
}

// ── Klinip Voice ──────────────────────────────────────────────────────────

export async function processVoiceSession({ audioConsent, audioSession, profileId, professionalRole }) {
  // Ensure token is fresh BEFORE building FormData — blobs are consumed on send
  // and cannot survive a 401-retry cycle.
  await _ensureFreshToken();
  const formData = new FormData();
  formData.append("audio_consent", audioConsent, buildVoiceUploadName("consent", audioConsent));
  formData.append("audio_session", audioSession, buildVoiceUploadName("session", audioSession));
  formData.append("profile_id", profileId);
  if (professionalRole) formData.append("professional_role", professionalRole);
  const res = await api.post("/voice/process", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 300000,
  });
  return res.data;
}

export async function getVoiceSessions() {
  const res = await api.get("/voice/sessions");
  return res.data;
}

export async function getVoiceSession(sessionId) {
  const res = await api.get(`/voice/sessions/${sessionId}`);
  return res.data;
}

export async function getVoiceShareTargets(profileId) {
  const res = await api.get(`/health-profiles/${profileId}/voice-share-targets`);
  return Array.isArray(res.data) ? res.data : [];
}

export async function getVoiceReceivedSessions() {
  const res = await api.get("/voice/shared/received");
  return Array.isArray(res.data) ? res.data : [];
}

export async function shareVoiceWithFamily(sessionId, payload) {
  const res = await api.post(`/voice/${sessionId}/share/family`, payload);
  return res.data;
}

export async function revokeVoiceFamilyShare(shareId) {
  const res = await api.delete(`/voice/family-shares/${shareId}`);
  return res.data;
}

export async function voiceShareLink(sessionId) {
  const res = await api.post(`/voice/${sessionId}/share/link`);
  return res.data;
}

export async function voiceShareEmail(sessionId, email) {
  const res = await api.post(`/voice/${sessionId}/share/email`, { email });
  return res.data;
}

export async function voiceDownloadPdf(sessionId) {
  const res = await api.get(`/voice/${sessionId}/pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `klinip-voice-${sessionId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function voiceAudioUrl(sessionId) {
  return `${API_URL}/voice/${sessionId}/audio`;
}

export async function getSharedVoiceSession(token) {
  const res = await axios.get(`${API_URL}/api/voice/shared/${token}`);
  return res.data;
}

export function sharedVoiceAudioUrl(token) {
  return `${API_URL}/api/voice/shared/${token}/audio`;
}
