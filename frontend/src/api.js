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
export const getPublicPlans = api.getPublicPlans;
export const getHealthProfiles = api.getHealthProfiles;
export const getActiveHealthProfile = api.getActiveHealthProfile;
export const createHealthProfile = api.createHealthProfile;
export const updateHealthProfile = api.updateHealthProfile;
export const setActiveHealthProfile = api.setActiveHealthProfile;
export const getFamilyPanel = api.getFamilyPanel;
export const getProfileCaregivers = api.getProfileCaregivers;
export const inviteProfileCaregiver = api.inviteProfileCaregiver;
export const getProfileInvitations = api.getProfileInvitations;
export const getMyPendingProfileInvitations = api.getMyPendingProfileInvitations;
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
export const updateProfileNote = api.updateProfileNote;
export const deleteProfileNote = api.deleteProfileNote;
export const sendAiChat = api.sendAiChat;
export const transcribeAiChatAudio = api.transcribeAiChatAudio;
export const getAiConversations = api.getAiConversations;
export const getAiHistory = api.getAiHistory;
export const deleteAiConversation = api.deleteAiConversation;
export const renameAiConversation = api.renameAiConversation;
export const clearAiHistory = api.clearAiHistory;
export const getAiHealthRadar = api.getAiHealthRadar;
export const runAiHealthRadar = api.runAiHealthRadar;
export const getAiAdherence = api.getAiAdherence;
export const getAiDocumentIntelligence = api.getAiDocumentIntelligence;
export const generateAiClinicalReport = api.generateAiClinicalReport;
export const getAiClinicalReports = api.getAiClinicalReports;
export const getAiClinicalReport = api.getAiClinicalReport;
export const getAiClinicalReportPdf = api.getAiClinicalReportPdf;
export const getAiFamilyContext = api.getAiFamilyContext;
export const getAiLifeTimeline = api.getAiLifeTimeline;
export const getClinicalEpisodes = api.getClinicalEpisodes;
export const getClinicalEpisodeDetail = api.getClinicalEpisodeDetail;
export const relinkClinicalEpisodeItem = api.relinkClinicalEpisodeItem;
export const getInteroperabilitySources = api.getInteroperabilitySources;
export const createInteroperabilitySource = api.createInteroperabilitySource;
export const getInteroperabilityRecords = api.getInteroperabilityRecords;
export const createInteroperabilityRecord = api.createInteroperabilityRecord;

export const getAppointments = api.getAppointments;
export const createAppointment = api.createAppointment;
export const updateAppointment = api.updateAppointment;
export const deleteAppointment = api.deleteAppointment;

export const getDocuments = api.getDocuments;
export const uploadDocument = api.uploadDocument;
export const deleteDocument = api.deleteDocument;
export const updateDocument = api.updateDocument;

export const getMedications = api.getMedications;
export const getBiometricDashboard = api.getBiometricDashboard;
export const createBiometricReading = api.createBiometricReading;
export const deleteBiometricReading = api.deleteBiometricReading;
export const saveMedication = api.saveMedication;
export const deleteMedication = api.deleteMedication;
export const recordMedicationIntake = api.recordMedicationIntake;
export const getMedicationIntakes = api.getMedicationIntakes;
export const getMedicationPurchases = api.getMedicationPurchases;
export const createMedicationPurchase = api.createMedicationPurchase;
export const getMedicationPurchaseReceipt = api.getMedicationPurchaseReceipt;
export const markMedicationRefillPurchased = api.markMedicationRefillPurchased;

export const revokeDataConsent = api.revokeDataConsent;
export const deleteAccount = api.deleteAccount;
export const submitPrivacyRequest = api.submitPrivacyRequest;

export const subscribePush = api.subscribePush;
export const unsubscribePush = api.unsubscribePush;
export const sendTestPush = api.sendTestPush;
export const getLandingStats = api.getLandingStats;

// Step-up auth
export const stepUpVerify = api.stepUpVerify;
export const requestStepUpEmailCode = api.requestStepUpEmailCode;
export const getDocumentFileWithStepUp = api.getDocumentFileWithStepUp;

// MFA
export const verifyMfaLogin = api.verifyMfaLogin;
export const getMfaStatus = api.getMfaStatus;
export const startMfaEnroll = api.startMfaEnroll;
export const verifyMfaEnrollment = api.verifyMfaEnrollment;
export const disableMfa = api.disableMfa;
export const regenerateMfaBackupCodes = api.regenerateMfaBackupCodes;

// Sessions
export const refreshAccessToken = api.refreshAccessToken;
export const getSessions = api.getSessions;
export const revokeSession = api.revokeSession;
export const revokeAllSessions = api.revokeAllSessions;
export const isAuthSessionError = api.isAuthSessionError;

// Permissions
export const getProfilePermissions = api.getProfilePermissions;
export const updateRelationshipPermissions = api.updateRelationshipPermissions;

// Audit log
export const getAuditLogs = api.getAuditLogs;

export const getDocumentFile = api.getDocumentFile;

// KlinipFeed
export const getFamilyFeed = api.getFamilyFeed;
export const createFeedPost = api.createFeedPost;
export const updateFeedPost = api.updateFeedPost;
export const deleteFeedPost = api.deleteFeedPost;
export const reactToPost = api.reactToPost;
export const removeReaction = api.removeReaction;
export const getPostComments = api.getPostComments;
export const addPostComment = api.addPostComment;
export const deletePostComment = api.deletePostComment;
export const likePostComment = api.likePostComment;
export const unlikePostComment = api.unlikePostComment;
export const uploadPostAttachment = api.uploadPostAttachment;
export const getPostAttachmentUrl = api.getPostAttachmentUrl;
export const uploadHealthProfileAvatar = api.uploadHealthProfileAvatar;

// Klinip Voice
export const processVoiceSession = api.processVoiceSession;
export const getVoiceSessions = api.getVoiceSessions;
export const getVoiceSession = api.getVoiceSession;
export const deleteVoiceSession = api.deleteVoiceSession;
export const getVoiceShareTargets = api.getVoiceShareTargets;
export const getVoiceReceivedSessions = api.getVoiceReceivedSessions;
export const shareVoiceWithFamily = api.shareVoiceWithFamily;
export const revokeVoiceFamilyShare = api.revokeVoiceFamilyShare;
export const voiceShareLink = api.voiceShareLink;
export const voiceShareEmail = api.voiceShareEmail;
export const voiceDownloadPdf = api.voiceDownloadPdf;
export const voiceAudioUrl = api.voiceAudioUrl;
export const voiceConsentAudioUrl = api.voiceConsentAudioUrl;
export const getSharedVoiceSession = api.getSharedVoiceSession;
export const sharedVoiceAudioUrl = api.sharedVoiceAudioUrl;
export const sharedVoiceConsentAudioUrl = api.sharedVoiceConsentAudioUrl;
