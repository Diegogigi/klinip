import * as httpApi from "./services/httpApi";

// API conectada siempre al backend real
const api = httpApi;

export const register = api.register;
export const login = api.login;
export const logout = api.logout;
export const forgotPassword = api.forgotPassword;
export const resetPassword = api.resetPassword;
export const getMe = api.getMe;
export const updateMe = api.updateMe;
export const getMyPlan = api.getMyPlan;
export const getHealthProfiles = api.getHealthProfiles;
export const getActiveHealthProfile = api.getActiveHealthProfile;
export const createHealthProfile = api.createHealthProfile;
export const updateHealthProfile = api.updateHealthProfile;
export const setActiveHealthProfile = api.setActiveHealthProfile;

export const getAppointments = api.getAppointments;
export const createAppointment = api.createAppointment;
export const updateAppointment = api.updateAppointment;
export const deleteAppointment = api.deleteAppointment;

export const getDocuments = api.getDocuments;
export const uploadDocument = api.uploadDocument;
export const deleteDocument = api.deleteDocument;
export const updateDocument = api.updateDocument;

export const getMedications = api.getMedications;
export const saveMedication = api.saveMedication;
export const deleteMedication = api.deleteMedication;
export const recordMedicationIntake = api.recordMedicationIntake;

export const revokeDataConsent = api.revokeDataConsent;
export const deleteAccount = api.deleteAccount;
export const submitPrivacyRequest = api.submitPrivacyRequest;

export const subscribePush = api.subscribePush;
export const unsubscribePush = api.unsubscribePush;
export const sendTestPush = api.sendTestPush;
export const getLandingStats = api.getLandingStats;
