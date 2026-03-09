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
export const getFamilyPanel = api.getFamilyPanel;
export const getProfileCaregivers = api.getProfileCaregivers;
export const inviteProfileCaregiver = api.inviteProfileCaregiver;
export const getProfileInvitations = api.getProfileInvitations;
export const acceptProfileInvitation = api.acceptProfileInvitation;
export const updateProfileRelationship = api.updateProfileRelationship;
export const removeProfileRelationship = api.removeProfileRelationship;
export const revokeProfileInvitation = api.revokeProfileInvitation;
export const getHealthProfileActivity = api.getHealthProfileActivity;
export const getFamilyAlerts = api.getFamilyAlerts;
export const getFamilyReportSummary = api.getFamilyReportSummary;
export const runFamilyAutomations = api.runFamilyAutomations;
export const getProfileAutomation = api.getProfileAutomation;
export const updateProfileAutomation = api.updateProfileAutomation;
export const getProfileNotes = api.getProfileNotes;
export const createProfileNote = api.createProfileNote;

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
